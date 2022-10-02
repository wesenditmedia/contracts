// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./EmergencyGuard.sol";
import "./interfaces/IDynamicFeeManager.sol";

/**
 * @title Base Dynamic Fee Manager
 */
abstract contract BaseDynamicFeeManager is
    IDynamicFeeManager,
    EmergencyGuard,
    AccessControlEnumerable,
    Ownable,
    ReentrancyGuard
{
    using SafeMath for uint256;

    // Role allowed to do admin operations like adding to fee whitelist, withdraw, etc.
    bytes32 public constant ADMIN = keccak256("ADMIN");

    // Role allowed to bypass fees
    bytes32 public constant FEE_WHITELIST = keccak256("FEE_WHITELIST");

    // Role allowed to token be sent to without fee
    bytes32 public constant RECEIVER_FEE_WHITELIST =
        keccak256("RECEIVER_FEE_WHITELIST");

    // Role allowed to bypass swap and liquify
    bytes32 public constant BYPASS_SWAP_AND_LIQUIFY =
        keccak256("BYPASS_SWAP_AND_LIQUIFY");

    // Role allowed to bypass wildcard fees
    bytes32 public constant EXCLUDE_WILDCARD_FEE =
        keccak256("EXCLUDE_WILDCARD_FEE");

    // Fee percentage limit
    uint256 public constant FEE_PERCENTAGE_LIMIT = 10000; // 10%

    // Fee percentage limit on creation
    uint256 public constant INITIAL_FEE_PERCENTAGE_LIMIT = 25000; // 25%

    // Transaction fee limit
    uint256 public constant TRANSACTION_FEE_LIMIT = 10; // 10%

    // Transaction fee limit on creation
    uint256 public constant INITIAL_TRANSACTION_FEE_LIMIT = 25; // 25%

    // Fee divider
    uint256 internal constant FEE_DIVIDER = 100000;

    // Wildcard address for fees
    address internal constant WHITELIST_ADDRESS =
        0x000000000000000000000000000000000000dEaD;

    // List of all currently added fees
    FeeEntry[] internal _fees;

    // Mapping id to current liquify or swap amounts
    mapping(bytes32 => uint256) internal _amounts;

    // Fees enabled state
    bool private _feesEnabled = false;

    // Pancake Router address
    IPancakeRouter02 private _pancakeRouter =
        IPancakeRouter02(address(0x10ED43C718714eb63d5aA57B78B54704E256024E));

    // BUSD address
    address private _busdAddress;

    // Fee percentage limit
    uint256 internal _feePercentageLimit;

    // Transaction fee limit
    uint256 internal _transactionFeeLimit;

    // Swap percentage
    uint256 internal _swapPercentage = 100;

    // WeSendit token
    IERC20 internal _token;

    constructor(address wesenditToken) {
        // Add creator to admin role
        _setupRole(ADMIN, _msgSender());

        // Set role admin for roles
        _setRoleAdmin(ADMIN, ADMIN);
        _setRoleAdmin(FEE_WHITELIST, ADMIN);
        _setRoleAdmin(RECEIVER_FEE_WHITELIST, ADMIN);
        _setRoleAdmin(BYPASS_SWAP_AND_LIQUIFY, ADMIN);
        _setRoleAdmin(EXCLUDE_WILDCARD_FEE, ADMIN);

        // Set initial values for limits
        _feePercentageLimit = INITIAL_FEE_PERCENTAGE_LIMIT;
        _transactionFeeLimit = INITIAL_TRANSACTION_FEE_LIMIT;

        // Create WeSendit token instance
        _token = IERC20(wesenditToken);
    }

    /**
     * Getter & Setter
     */
    function getFee(uint256 index)
        public
        view
        override
        returns (FeeEntry memory fee)
    {
        return _fees[index];
    }

    function getFeeAmount(bytes32 id) public view returns (uint256 amount) {
        return _amounts[id];
    }

    function feesEnabled() public view override returns (bool) {
        return _feesEnabled;
    }

    function setFeesEnabled(bool value) external override onlyRole(ADMIN) {
        _feesEnabled = value;
    }

    function pancakeRouter()
        public
        view
        override
        returns (IPancakeRouter02 value)
    {
        return _pancakeRouter;
    }

    function setPancakeRouter(address value) external override onlyRole(ADMIN) {
        _pancakeRouter = IPancakeRouter02(value);
        emit PancakeRouterUpdated(value);
    }

    function busdAddress() public view override returns (address value) {
        return _busdAddress;
    }

    function setBusdAddress(address value) external override onlyRole(ADMIN) {
        _busdAddress = value;
        emit BusdAddressUpdated(value);
    }

    function feePercentageLimit() public view override returns (uint256 value) {
        return _feePercentageLimit;
    }

    function transactionFeeLimit()
        public
        view
        override
        returns (uint256 value)
    {
        return _transactionFeeLimit;
    }

    function decreaseFeeLimits() external override onlyRole(ADMIN) {
        require(
            _feePercentageLimit != FEE_PERCENTAGE_LIMIT &&
                _transactionFeeLimit != TRANSACTION_FEE_LIMIT,
            "DynamicFeeManager: Fee limits are already decreased"
        );

        _feePercentageLimit = FEE_PERCENTAGE_LIMIT;
        _transactionFeeLimit = TRANSACTION_FEE_LIMIT;

        emit FeeLimitsDecreased();
    }

    function emergencyWithdraw(uint256 amount)
        external
        override
        onlyRole(ADMIN)
    {
        super._emergencyWithdraw(amount);
    }

    function emergencyWithdrawToken(address tokenToWithdraw, uint256 amount)
        external
        override
        onlyRole(ADMIN)
    {
        super._emergencyWithdrawToken(tokenToWithdraw, amount);
    }

    function swapPercentage() public view override returns (uint256 value) {
        return _swapPercentage;
    }

    function setSwapPercentage(uint256 value)
        external
        override
        onlyRole(ADMIN)
    {
        require(
            _swapPercentage >= 0 && _swapPercentage <= 100,
            "DynamicFeeManager: Invalid value for swap percentage"
        );

        _swapPercentage = value;
    }

    function token() public view override returns (IERC20 value) {
        return _token;
    }

    /**
     * Swaps half of the token amount and add liquidity on Pancakeswap
     *
     * @param amount uint256 - Amount to use
     * @param destination address - Destination address for the LP tokens
     */
    function _swapAndLiquify(uint256 amount, address destination)
        internal
        nonReentrant
    {
        // split the contract balance into halves
        uint256 half = amount.div(2);
        uint256 otherHalf = amount.sub(half);

        // capture the contract's current BNB balance.
        // this is so that we can capture exactly the amount of BNB that the
        // swap creates, and not make the liquidity event include any BNB that
        // has been manually sent to the contract
        uint256 initialBalance = address(this).balance;

        // swap tokens for BNB
        _swapTokensForBnb(half, destination); // <- this breaks the BNB -> WSI swap when swap+liquify is triggered

        // how much BNB did we just swap into?
        uint256 newBalance = address(this).balance.sub(initialBalance);

        // add liquidity to uniswap
        _addLiquidity(otherHalf, newBalance, destination);

        emit SwapAndLiquify(half, newBalance, otherHalf);
    }

    /**
     * Swaps tokens against BNB on Pancakeswap
     *
     * @param amount uint256 - Amount to use
     * @param destination address - Destination address for BNB
     */
    function _swapTokensForBnb(uint256 amount, address destination) internal {
        // generate the uniswap pair path of token -> wbnb
        address[] memory path = new address[](2);
        path[0] = address(token());
        path[1] = pancakeRouter().WETH();

        require(
            token().approve(address(pancakeRouter()), amount),
            "DynamicFeeManager: Failed to approve token for swap BNB"
        );

        // make the swap
        pancakeRouter().swapExactTokensForETHSupportingFeeOnTransferTokens(
            amount,
            0, // accept any amount of BNB
            path,
            destination,
            block.timestamp
        );
    }

    /**
     * Swaps tokens against BUSD on Pancakeswap
     *
     * @param amount uint256 - Amount to use
     * @param destination address - Destination address for BUSD
     */
    function _swapTokensForBusd(uint256 amount, address destination)
        internal
        nonReentrant
    {
        // generate the uniswap pair path of token -> wbnb
        address[] memory path = new address[](2);
        path[0] = address(token());
        path[1] = busdAddress();

        require(
            token().approve(address(pancakeRouter()), amount),
            "DynamicFeeManager: Failed to approve token for swap to BUSD"
        );

        // capture the contract's current BUSD balance.
        uint256 initialBalance = token().balanceOf(destination);

        // make the swap
        pancakeRouter().swapExactTokensForTokensSupportingFeeOnTransferTokens(
            amount,
            0, // accept any amount of BUSD
            path,
            destination,
            block.timestamp
        );

        // how much BUSD did we just swap into?
        uint256 newBalance = token().balanceOf(destination).sub(initialBalance);

        emit SwapTokenForBusd(
            address(token()),
            amount,
            newBalance,
            destination
        );
    }

    /**
     * Creates liquidity on Pancakeswap
     *
     * @param tokenAmount uint256 - Amount of token to use
     * @param bnbAmount uint256 - Amount of BNB to use
     * @param destination address - Destination address for the LP tokens
     */
    function _addLiquidity(
        uint256 tokenAmount,
        uint256 bnbAmount,
        address destination
    ) internal {
        // approve token transfer to cover all possible scenarios
        require(
            token().approve(address(pancakeRouter()), tokenAmount),
            "DynamicFeeManager: Failed to approve token for adding liquidity"
        );

        // add the liquidity
        pancakeRouter().addLiquidityETH{value: bnbAmount}(
            address(token()),
            tokenAmount,
            0, // slippage is unavoidable
            0, // slippage is unavoidable
            destination,
            block.timestamp
        );
    }
}
