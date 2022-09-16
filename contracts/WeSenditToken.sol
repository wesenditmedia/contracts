// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "./interfaces/IWeSenditToken.sol";
import "./interfaces/IStakingPool.sol";
import "./interfaces/IPancakeRouter.sol";

contract WeSenditToken is
    IWeSenditToken,
    ERC20Capped,
    ERC20Burnable,
    Ownable,
    AccessControlEnumerable,
    ReentrancyGuard
{
    using SafeMath for uint256;

    uint256 public constant INITIAL_SUPPLY = 37500000 * 1 ether;
    uint256 public constant TOTAL_SUPPLY = 1500000000 * 1 ether;

    // Role allowed to do admin operations like adding to fee whitelist, withdraw, etc.
    bytes32 public constant ADMIN = keccak256("ADMIN");
    // Role allowed to bypass fees
    bytes32 public constant FEE_WHITELIST = keccak256("FEE_WHITELIST");
    // Role allowed to token be sent to without fee
    bytes32 public constant RECEIVER_FEE_WHITELIST =
        keccak256("RECEIVER_FEE_WHITELIST");
    // Role allowed to bypass pause
    bytes32 public constant BYPASS_PAUSE = keccak256("BYPASS_PAUSE");
    // Role allowed to bypass swap and liquify
    bytes32 public constant BYPASS_SWAP_AND_LIQUIFY =
        keccak256("BYPASS_SWAP_AND_LIQUIFY");

    // Applied fees
    FeeEntry[] public fees;

    uint256 private _minTxAmount = 0;
    bool private _paused = false;
    IPancakeRouter02 private _pancakeRouter =
        IPancakeRouter02(address(0x10ED43C718714eb63d5aA57B78B54704E256024E));
    bool private _feesEnabled = false;
    bool private _swapAndLiquifyEnabled = false;
    uint256 private _swapAndLiquifyBalance = 0;
    address private _stakingPoolAddress = address(0);

    constructor(address addressTotalSupply)
        ERC20("WeSendit", "WSI")
        ERC20Capped(TOTAL_SUPPLY)
    {
        _setupRole(ADMIN, msg.sender);
        _setRoleAdmin(ADMIN, ADMIN);
        _setRoleAdmin(FEE_WHITELIST, ADMIN);
        _setRoleAdmin(BYPASS_PAUSE, ADMIN);
        _setRoleAdmin(RECEIVER_FEE_WHITELIST, ADMIN);
        _setRoleAdmin(BYPASS_SWAP_AND_LIQUIFY, ADMIN);

        ERC20Capped._mint(addressTotalSupply, TOTAL_SUPPLY);
    }

    /**
     * Getter & Setter
     */
    function initialSupply() public pure override returns (uint256) {
        return INITIAL_SUPPLY;
    }

    function minTxAmount() public view override returns (uint256) {
        return _minTxAmount;
    }

    function setMinTxAmount(uint256 value) public override onlyRole(ADMIN) {
        _minTxAmount = value;
        emit MinTxAmountUpdated(value);
    }

    function paused() public view override returns (bool) {
        return _paused;
    }

    function setPaused(bool value) public override onlyRole(ADMIN) {
        _paused = value;
        emit PausedUpdated(value);
    }

    function pancakeRouter()
        public
        view
        override
        returns (IPancakeRouter02 router)
    {
        return _pancakeRouter;
    }

    function setPancakeRouter(address value) public override onlyRole(ADMIN) {
        _pancakeRouter = IPancakeRouter02(value);
        emit PancakeRouterUpdated(value);
    }

    function swapAndLiquifyEnabled() public view override returns (bool) {
        return _swapAndLiquifyEnabled;
    }

    function setSwapAndLiquifyEnabled(bool value)
        public
        override
        onlyRole(ADMIN)
    {
        _swapAndLiquifyEnabled = value;
        emit SwapAndLiquifyEnabledUpdated(value);
    }

    function swapAndLiquifyBalance() public view override returns (uint256) {
        return _swapAndLiquifyBalance;
    }

    function setSwapAndLiquifyBalance(uint256 value) public override {
        _swapAndLiquifyBalance = value;
        emit SwapAndLiquifyBalanceUpdated(value);
    }

    function feesEnabled() public view override returns (bool) {
        return _feesEnabled;
    }

    function setFeesEnabled(bool value) public override onlyRole(ADMIN) {
        _feesEnabled = value;
    }

    function stakingPoolAddress() public view override returns (address) {
        return _stakingPoolAddress;
    }

    function setStakingPoolAddress(address value)
        public
        override
        onlyRole(ADMIN)
    {
        _stakingPoolAddress = value;
        emit StakingPoolAddressUpdated(value);
    }

    function distributeToken(address receiver, uint256 amount)
        external
        onlyRole(ADMIN)
    {
        _transfer(address(this), receiver, amount);
    }

    /*
     * Dynamic fees
     */
    function getFee(uint256 index)
        public
        view
        override
        returns (FeeEntry memory fee)
    {
        return fees[index];
    }

    function addFee(
        address from,
        address to,
        uint256 percentage,
        address destination
    ) public override onlyRole(ADMIN) returns (uint256 index) {
        FeeEntry memory feeEntry = FeeEntry(from, to, percentage, destination);

        // TODO: add limit for total fees, add limit for fee percentage summary

        fees.push(feeEntry);

        emit FeeAdded(from, to, percentage, destination);
        return fees.length - 1;
    }

    function removeFee(uint256 index) public override onlyRole(ADMIN) {
        require(index < fees.length, "WeSendit: array out of bounds");

        fees[index] = fees[fees.length - 1];
        fees.pop();

        emit FeeRemoved(index);
    }

    function _reflectFees(
        address from,
        address to,
        uint256 amount
    ) private returns (uint256 tAmount, uint256 tTotalFee) {
        // Exclude admins and whitelisted addresses from the fee
        if (
            !feesEnabled() ||
            hasRole(ADMIN, _msgSender()) ||
            hasRole(FEE_WHITELIST, _msgSender()) ||
            hasRole(RECEIVER_FEE_WHITELIST, to) ||
            from == owner()
        ) {
            return (amount, 0);
        }

        uint256 tFees = 0;

        for (uint256 i = 0; i < fees.length; i++) {
            FeeEntry memory fee = fees[i];

            if (fee.from == address(0) || fee.from == from) {
                uint256 tFee = _reflectFee(from, amount, fee);
                tFees = tFees.add(tFee);
            } else if (fee.to == address(0) || fee.to == to) {
                uint256 tFee = _reflectFee(from, amount, fee);
                tFees = tFees.add(tFee);
            }
        }

        uint256 tTotal = amount.sub(tFees);
        require(tTotal > 0, "WeSendit: invalid total amount");
        require(tTotal.add(tFees) == amount, "WeSendit: invalid transfer amount");

        return (tTotal, tFees);
    }

    function _reflectFee(
        address from,
        uint256 amount,
        FeeEntry memory fee
    ) private returns (uint256 tFee) {
        uint256 feeAmount = amount.mul(fee.percentage).div(100000); // ex. 125/100000 = 0.000125 = 0.0125%
        _transfer(from, fee.destination, feeAmount);

        if (stakingPoolAddress() != address(0)) {
            IStakingPool(stakingPoolAddress()).onERC20Received(from, feeAmount);
        }

        return feeAmount;
    }

    /**
     * Swap and Liquify
     */
    function _swapAndLiquify() private nonReentrant {
        // split the contract balance into halves
        uint256 half = swapAndLiquifyBalance().div(2);
        uint256 otherHalf = swapAndLiquifyBalance().sub(half);

        // capture the contract's current ETH balance.
        // this is so that we can capture exactly the amount of ETH that the
        // swap creates, and not make the liquidity event include any ETH that
        // has been manually sent to the contract
        uint256 initialBalance = address(this).balance;

        // swap tokens for ETH
        _swapTokensForBnb(half); // <- this breaks the ETH -> HATE swap when swap+liquify is triggered

        // how much ETH did we just swap into?
        uint256 newBalance = address(this).balance.sub(initialBalance);

        // add liquidity to uniswap
        _addLiquidity(otherHalf, newBalance);

        emit SwapAndLiquify(half, newBalance, otherHalf);
    }

    function _swapTokensForBnb(uint256 tokenAmount) private {
        // generate the uniswap pair path of token -> weth
        address[] memory path = new address[](2);
        path[0] = address(this);
        path[1] = pancakeRouter().WETH();

        _approve(address(this), address(pancakeRouter()), tokenAmount);

        // make the swap
        pancakeRouter().swapExactTokensForETHSupportingFeeOnTransferTokens(
            tokenAmount,
            0, // accept any amount of ETH
            path,
            address(this),
            block.timestamp
        );
    }

    function _addLiquidity(uint256 tokenAmount, uint256 ethAmount) private {
        // approve token transfer to cover all possible scenarios
        _approve(address(this), address(pancakeRouter()), tokenAmount);

        // add the liquidity
        pancakeRouter().addLiquidityETH{value: ethAmount}(
            address(this),
            tokenAmount,
            0, // slippage is unavoidable
            0, // slippage is unavoidable
            owner(),
            block.timestamp
        );
    }

    /**
     * Transfers
     */
    function transfer(address to, uint256 amount)
        public
        virtual
        override
        returns (bool)
    {
        address from = _msgSender();
        _preValidateTransfer(from, to, amount);

        (uint256 tTotal, ) = _reflectFees(from, to, amount);
        _preTransfer(from, to, amount);
        _transfer(from, to, tTotal);

        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) public virtual override returns (bool) {
        _preValidateTransfer(from, to, amount);

        address spender = _msgSender();

        _spendAllowance(from, spender, amount);

        (uint256 tTotal, ) = _reflectFees(from, to, amount);
        _preTransfer(from, to, amount);
        _transfer(from, to, tTotal);

        return true;
    }

    function _preValidateTransfer(
        address from,
        address to,
        uint256 amount
    ) private view returns (bool) {
        require(
            amount >= minTxAmount(),
            "WeSendit: amount is less than minTxAmount"
        );

        require(
            from == owner() ||
                !paused() ||
                hasRole(ADMIN, from) ||
                hasRole(BYPASS_PAUSE, from),
            "WeSendit: transactions are paused"
        );

        return true;
    }

    function _preTransfer(
        address from,
        address to,
        uint256 amount
    ) private {
        bool overMinTokenBalance = balanceOf(address(this)) >=
            swapAndLiquifyBalance();

        if (
            overMinTokenBalance &&
            !hasRole(ADMIN, from) &&
            !hasRole(BYPASS_SWAP_AND_LIQUIFY, from) &&
            swapAndLiquifyEnabled()
        ) {
            _swapAndLiquify();
        }
    }

    /**
     * Emergency
     */
    function emergencyWithdraw(uint256 amount) public override onlyRole(ADMIN) {
        address payable sender = payable(_msgSender());
        (bool sent, ) = sender.call{value: amount}("");
        require(sent, "WeSendit: Failed to send BNB");

        emit EmergencyWithdraw(_msgSender(), amount);
    }

    function emergencyWithdrawToken(uint256 amount)
        public
        override
        onlyRole(ADMIN)
    {
        _transfer(address(this), _msgSender(), amount);
        emit EmergencyWithdrawToken(_msgSender(), amount);
    }

    function _mint(address account, uint256 amount)
        internal
        virtual
        override(ERC20, ERC20Capped)
    {
        super._mint(account, amount);
    }
}
