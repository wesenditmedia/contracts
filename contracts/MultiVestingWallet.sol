// SPDX-License-Identifier: MIT
// Based on VestingWallet from OpenZeppelin Contracts (last updated v4.8.0) (finance/VestingWallet.sol)
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./interfaces/IMultiVestingWallet.sol";
import "./EmergencyGuard.sol";

import "hardhat/console.sol";

contract MultiVestingWallet is
    IMultiVestingWallet,
    Context,
    Ownable,
    EmergencyGuard
{
    uint64 private immutable _start;
    uint64 private immutable _duration;

    // Total initial ETH amount
    uint256 private _totalInitialETH;

    // Mapping from token to total initial token amount
    mapping(address => uint256) private _totalInitialToken;

    // Total released token amount
    uint256 private _totalReleasedETH;

    // Mapping from ttoken to total released token amount
    mapping(address => uint256) private _totalReleasedToken;

    // Mapping from beneficiary address to initial ETH
    mapping(address => uint256) private _userInitialETH;

    // Mapping from beneficiary address to release ETH
    mapping(address => uint256) private _userReleaseETH;

    // Mapping from beneficiary address to token address to initial token
    mapping(address => mapping(address => uint256)) private _userInitialToken;

    // Mapping from beneficiary address to token address to release token
    mapping(address => mapping(address => uint256)) private _userReleasedToken;

    /**
     * @dev Set the start timestamp and vesting duration of the vesting wallet.
     */
    constructor(uint64 startTimestamp, uint64 durationSeconds) payable {
        _start = startTimestamp;
        _duration = durationSeconds;
    }

    receive() external payable virtual {}

    function addBeneficiaries(
        address[] calldata beneficiaries,
        uint256[] calldata amounts
    ) external virtual onlyOwner {
        require(
            beneficiaries.length == amounts.length,
            "MultiVestingWallet: mismatching beneficiaries / amounts pair"
        );

        for (uint256 i = 0; i < beneficiaries.length; i++) {
            addBeneficiary(beneficiaries[i], amounts[i]);
        }
    }

    function addBeneficiaries(
        address[] calldata beneficiaries,
        address token,
        uint256[] calldata amounts
    ) external virtual onlyOwner {
        require(
            beneficiaries.length == amounts.length,
            "MultiVestingWallet: mismatching beneficiaries / amounts pair"
        );

        for (uint256 i = 0; i < beneficiaries.length; i++) {
            addBeneficiary(beneficiaries[i], token, amounts[i]);
        }
    }

    function addBeneficiary(
        address beneficiary,
        uint256 amount
    ) public virtual onlyOwner {
        require(
            address(this).balance + _totalReleasedETH - _totalInitialETH >=
                amount,
            "MultiVestingWallet: ETH amount exceeds balance"
        );

        _userInitialETH[beneficiary] = amount;
        _totalInitialETH += amount;
    }

    function addBeneficiary(
        address beneficiary,
        address token,
        uint256 amount
    ) public virtual onlyOwner {
        require(
            IERC20(token).balanceOf(address(this)) +
                _totalReleasedToken[token] -
                _totalInitialToken[token] >=
                amount,
            "MultiVestingWallet: Token amount exceeds balance"
        );

        _userInitialToken[beneficiary][token] = amount;
        _totalInitialToken[token] += amount;
    }

    function start() public view virtual returns (uint256) {
        return _start;
    }

    function duration() public view virtual returns (uint256) {
        return _duration;
    }

    function initial(
        address beneficiary
    ) public view virtual returns (uint256) {
        return _userInitialETH[beneficiary];
    }

    function initial(
        address beneficiary,
        address token
    ) public view virtual returns (uint256) {
        return _userInitialToken[beneficiary][token];
    }

    function released(
        address beneficiary
    ) public view virtual returns (uint256) {
        return _userReleaseETH[beneficiary];
    }

    function released(
        address beneficiary,
        address token
    ) public view virtual returns (uint256) {
        return _userReleasedToken[beneficiary][token];
    }

    function releasable(
        address beneficiary
    ) public view virtual returns (uint256) {
        return
            vestedAmount(beneficiary, uint64(block.timestamp)) -
            released(beneficiary);
    }

    function releasable(
        address beneficiary,
        address token
    ) public view virtual returns (uint256) {
        return
            vestedAmount(beneficiary, token, uint64(block.timestamp)) -
            released(beneficiary, token);
    }

    function release(address beneficiary) public virtual {
        uint256 amount = releasable(beneficiary);
        _userReleaseETH[beneficiary] += amount;
        _totalReleasedETH += amount;
        emit EtherReleased(beneficiary, amount);
        Address.sendValue(payable(beneficiary), amount);
    }

    function release(address beneficiary, address token) public virtual {
        uint256 amount = releasable(beneficiary, token);
        _userReleasedToken[beneficiary][token] += amount;
        _totalReleasedToken[token] += amount;
        emit ERC20Released(beneficiary, token, amount);
        SafeERC20.safeTransfer(IERC20(token), beneficiary, amount);
    }

    function vestedAmount(
        address beneficiary,
        uint64 timestamp
    ) public view virtual returns (uint256) {
        return _vestingSchedule(_userInitialETH[beneficiary], timestamp);
    }

    function vestedAmount(
        address beneficiary,
        address token,
        uint64 timestamp
    ) public view virtual returns (uint256) {
        return
            _vestingSchedule(_userInitialToken[beneficiary][token], timestamp);
    }

    /**
     * @dev Virtual implementation of the vesting formula. This returns the amount vested, as a function of time, for
     * an asset given its total historical allocation.
     */
    function _vestingSchedule(
        uint256 totalAllocation,
        uint64 timestamp
    ) internal view virtual returns (uint256) {
        if (timestamp < start()) {
            return 0;
        } else if (timestamp > start() + duration()) {
            return totalAllocation;
        } else {
            return (totalAllocation * (timestamp - start())) / duration();
        }
    }

    function emergencyWithdraw(uint256 amount) external override onlyOwner {
        super._emergencyWithdraw(amount);
    }

    function emergencyWithdrawToken(
        address token,
        uint256 amount
    ) external override onlyOwner {
        super._emergencyWithdrawToken(token, amount);
    }
}
