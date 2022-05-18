// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MultiVestingWallet is Context, Ownable {
    using SafeMath for uint256;

    event EtherReleased(address indexed receiver, uint256 amount);
    event ERC20Released(
        address indexed token,
        address indexed receiver,
        uint256 amount
    );

    uint256 private _released;
    bool private _isVestingStarted = false;

    mapping(address => uint256) private _erc20Released;
    address[] private _beneficiaries;
    uint64 private _start;
    uint64 private _duration;

    /**
     * @dev Set the beneficiary, start timestamp and vesting duration of the vesting wallet.
     */
    constructor(uint64 startTimestamp, uint64 durationSeconds) {
        _start = startTimestamp;
        _duration = durationSeconds;
    }

    modifier onlyBeforeStart() {
        require(
            _isVestingStarted == false,
            "MultiVestingWallet: Vesting is already active"
        );
        _;
    }

    function setStartTimestamp(uint64 timestamp)
        external
        onlyOwner
        onlyBeforeStart
    {
        _start = timestamp;
    }

    function setDuration(uint64 value) external onlyOwner onlyBeforeStart {
        _duration = value;
    }

    function addBeneficiaries(address[] calldata addrs)
        external
        onlyOwner
        onlyBeforeStart
    {
        for (uint256 i = 0; i < addrs.length; i++) {
            _beneficiaries.push(addrs[i]);
        }
    }

    function addBeneficiary(address addr) external onlyOwner onlyBeforeStart {
        _beneficiaries.push(addr);
    }

    function removeBeneficiary(address addr)
        external
        onlyOwner
        onlyBeforeStart
    {
        for (uint256 i = 0; i < _beneficiaries.length; i++) {
            if (_beneficiaries[i] == addr) {
                _beneficiaries[i] = _beneficiaries[_beneficiaries.length - 1];
                _beneficiaries.pop();
                break;
            }
        }
    }

    /**
     * @dev The contract should be able to receive Eth.
     */
    receive() external payable virtual {}

    function isVestingStarted() public view virtual returns (bool) {
        return _isVestingStarted;
    }

    function beneficiaries() public view virtual returns (address[] memory) {
        return _beneficiaries;
    }

    /**
     * @dev Getter for the start timestamp.
     */
    function start() public view virtual returns (uint256) {
        return _start;
    }

    /**
     * @dev Getter for the vesting duration.
     */
    function duration() public view virtual returns (uint256) {
        return _duration;
    }

    /**
     * @dev Amount of eth already released
     */
    function released() public view virtual returns (uint256) {
        return _released;
    }

    /**
     * @dev Amount of token already released
     */
    function released(address token) public view virtual returns (uint256) {
        return _erc20Released[token];
    }

    /**
     * @dev Release the native token (ether) that have already vested.
     *
     * Emits a {TokensReleased} event.
     */
    function release() public virtual {
        _setVestingStarted();

        uint256 releasable = vestedAmount(uint64(block.timestamp)) - released();
        _released += releasable;

        for (uint256 i = 0; i < _beneficiaries.length; i++) {
            emit EtherReleased(
                _beneficiaries[i],
                releasable.div(_beneficiaries.length)
            );
            Address.sendValue(
                payable(_beneficiaries[i]),
                releasable.div(_beneficiaries.length)
            );
        }
    }

    /**
     * @dev Release the tokens that have already vested.
     *
     * Emits a {TokensReleased} event.
     */
    function release(address token) public virtual {
        _setVestingStarted();

        uint256 releasable = vestedAmount(token, uint64(block.timestamp)) -
            released(token);
        _erc20Released[token] += releasable;

        for (uint256 i = 0; i < _beneficiaries.length; i++) {
            emit ERC20Released(
                _beneficiaries[i],
                token,
                releasable.div(_beneficiaries.length)
            );
            SafeERC20.safeTransfer(
                IERC20(token),
                _beneficiaries[i],
                releasable.div(_beneficiaries.length)
            );
        }
    }

    /**
     * @dev Calculates the amount of ether that has already vested. Default implementation is a linear vesting curve.
     */
    function vestedAmount(uint64 timestamp)
        public
        view
        virtual
        returns (uint256)
    {
        return _vestingSchedule(address(this).balance + released(), timestamp);
    }

    /**
     * @dev Calculates the amount of tokens that has already vested. Default implementation is a linear vesting curve.
     */
    function vestedAmount(address token, uint64 timestamp)
        public
        view
        virtual
        returns (uint256)
    {
        return
            _vestingSchedule(
                IERC20(token).balanceOf(address(this)) + released(token),
                timestamp
            );
    }

    function _setVestingStarted() internal virtual {
        if (_isVestingStarted == false && uint64(block.timestamp) >= start()) {
            _isVestingStarted = true;
        }
    }

    /**
     * @dev Virtual implementation of the vesting formula. This returns the amount vested, as a function of time, for
     * an asset given its total historical allocation.
     */
    function _vestingSchedule(uint256 totalAllocation, uint64 timestamp)
        internal
        view
        virtual
        returns (uint256)
    {
        if (timestamp < start()) {
            return 0;
        } else if (timestamp > start() + duration()) {
            return totalAllocation;
        } else {
            return (totalAllocation * (timestamp - start())) / duration();
        }
    }
}
